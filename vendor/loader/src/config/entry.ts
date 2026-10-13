import { Context, Fiber, FiberState, Inject, resolveConfig } from '@deepseek-ai/cordis'
import { deepEqual, isNullable, updateVolatile, volatileEntries, type Volatile } from '@deepseek-ai/cosmokit'
import { Loader } from '../index.ts'
import { EntryGroup } from './group.ts'
import { EntryTree } from './tree.ts'
import { evaluate, isJsExpr } from './utils.ts'
import { equalExceptVolatile } from './diff.ts'

/** Serialized plugin entry options stored in loader config files. */
export interface EntryOptions {
  /** Stable id inside the containing entry tree. */
  id: string
  /** Module specifier imported by the entry tree. */
  name: string
  /** Config passed to the plugin. */
  config?: any
  /** Marks this entry as a nested group. */
  group?: boolean | null
  /** Prevents this entry and descendants from running. */
  disabled?: boolean | null
  /** Required services or service intercept config for this entry. */
  inject?: Inject | null
}

function updateError(stage: 'import' | 'dispose' | 'apply' | 'rollback', options: EntryOptions, cause: unknown) {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(`failed to ${stage} loader entry ${options.id} (${options.name}): ${detail}`, { cause })
}

function takeEntries(object: {}, keys: string[]) {
  const result: [string, any][] = []
  for (const key of keys) {
    if (!(key in object)) continue
    result.push([key, object[key]])
    delete object[key]
  }
  return result
}

function sortKeys<T extends {}>(object: T, prepend = ['id', 'name'], append = ['config']): T {
  const part1 = takeEntries(object, prepend)
  const part2 = takeEntries(object, append)
  const rest = takeEntries(object, Object.keys(object)).sort(([a], [b]) => a.localeCompare(b))
  return Object.assign(object, Object.fromEntries([...part1, ...rest, ...part2]))
}

function replaceKeys<T extends {}>(target: T, source: T): T {
  for (const key of Object.keys(target)) Reflect.deleteProperty(target, key)
  return Object.assign(target, source)
}

/** One configured plugin node inside an `EntryTree`. */
export class Entry {
  static readonly key = Symbol.for('cordis.entry')

  public ctx: Context
  public fiber?: Fiber
  /** Raw import result before export normalization; HMR updates it after a successful reload. */
  public moduleNamespace: unknown
  public parent!: EntryGroup
  // safety: call `entry.update()` immediately after creating an entry
  public options = {} as EntryOptions
  public subgroup?: EntryGroup
  public subtree?: EntryTree

  _initTask?: Promise<void>
  _disposing = 0

  constructor(public loader: Loader) {
    this.ctx = loader.ctx.extend({ [Entry.key]: this })
    this.context.emit('loader/entry-init', this)
  }

  get context(): Context {
    return this.ctx
  }

  get id() {
    let id = this.options.id
    if (this.parent.tree.ctx.fiber.entry) {
      id = this.parent.tree.ctx.fiber.entry.id + EntryTree.sep + id
    }
    return id
  }

  /** True when this entry or any owning parent entry is disabled. */
  get disabled() {
    return this._disabled(this.options)
  }

  private _disabled(options: EntryOptions) {
    // group is always enabled
    if (options.group) return false
    if (this.disabledOf(options)) return true
    let entry = this.parent.ctx.fiber.entry
    while (entry) {
      if (this.disabledOf(entry.options)) return true
      entry = entry.parent.ctx.fiber.entry
    }
    return false
  }

  /**
   * Effective disabled state: a `!!js` expression evaluates against the loader
   * context. The raw node stays in the options, so write-back keeps the form.
   */
  private disabledOf(options: EntryOptions): boolean {
    return isJsExpr(options.disabled)
      ? Boolean(this.evaluate(options.disabled.__jsExpr))
      : Boolean(options.disabled)
  }

  evaluate(expr: string) {
    return evaluate(this.ctx, expr)
  }

  private async _patchContext(diff: string[]) {
    await this.context.waterfall('loader/patch-context', this, async () => {
      Object.setPrototypeOf(this.ctx, this.parent.ctx)

      if (this.fiber?.uid && (diff.includes('config') || this.options.group)) {
        await this.fiber.update(this.options.config, true)
      }
    })
  }

  async refresh() {
    if (this.fiber) return
    if (this.disabled) return
    await this.init()
  }

  async _dispose(fiber = this.fiber) {
    if (!fiber) return
    if (this.fiber === fiber) this.fiber = undefined
    this._disposing += 1
    try {
      await fiber.dispose()
    } finally {
      this._disposing -= 1
    }
  }

  /** Merge new options, restart as needed, and persist through the parent tree. */
  async update(options: Partial<EntryOptions>, create = false, force = false) {
    const previousOptions = this.options
    const legacy = { ...previousOptions }
    const candidate = create ? options as EntryOptions : { ...previousOptions }
    if (!create) {
      for (const [key, value] of Object.entries(options)) {
        if (isNullable(value)) {
          delete candidate[key as keyof EntryOptions]
        } else {
          candidate[key as keyof EntryOptions] = value as never
        }
      }
    }
    sortKeys(candidate)

    const diff = Object
      .keys({ ...candidate, ...legacy })
      .filter(key => !deepEqual(candidate[key as keyof EntryOptions], legacy[key as keyof EntryOptions]))
    if (!diff.length && !force) return

    const commit = () => {
      if (create) return
      this.options = replaceKeys(previousOptions, candidate)
    }

    const previous = this.fiber
    if (!previous?.uid) {
      this.fiber = undefined
      this.options = candidate
      try {
        if (!this._disabled(candidate)) await this.init()
      } catch (error) {
        this.options = previousOptions
        throw error
      }
      commit()
      return
    }

    if (this._disabled(candidate)) {
      this.options = candidate
      try {
        await this._dispose(previous)
      } catch (error) {
        this.options = previousOptions
        throw updateError('dispose', candidate, error)
      }
      commit()
      this.context.emit('loader/partial-dispose', this, legacy, true)
      return
    }

    const replace = diff.some(key => key === 'name' || key === 'inject' || key === 'group')
    if (!replace) {
      // Only an active fiber in an unchanged context takes volatile-only config changes without a remount.
      const volatileOnly = diff.length === 1 && diff[0] === 'config'
        && previous.state === FiberState.ACTIVE && Object.getPrototypeOf(this.ctx) === this.parent.ctx
        && equalExceptVolatile(legacy.config, candidate.config, previous.runtime?.Config)
      if (volatileOnly) {
        previous._config = candidate.config
        if (this._commitVolatile(previous, candidate.config)) {
          this.options = candidate
          commit()
          return
        }
      }
      this.options = candidate
      try {
        await this._patchContext(diff)
      } catch (error) {
        this.options = previousOptions
        try {
          await this._patchContext(diff)
        } catch (rollbackError) {
          throw updateError('rollback', legacy, new AggregateError([error, rollbackError]))
        }
        this.context.emit('loader/partial-dispose', this, candidate, true)
        throw updateError('apply', candidate, error)
      }
      commit()
      this.context.emit('loader/partial-dispose', this, legacy, true)
      return
    }

    let plugin: any
    try {
      plugin = diff.includes('name')
        ? this.loader.unwrapExports(await this.parent.tree.import(candidate.name, this.getOuterStack))
        : previous.runtime!.callback
    } catch (error) {
      throw updateError('import', candidate, error)
    }

    const previousPlugin = previous.runtime!.callback
    this.options = candidate
    try {
      await this._dispose(previous)
    } catch (error) {
      this.options = previousOptions
      throw updateError('dispose', candidate, error)
    }

    try {
      await this._start(plugin)
    } catch (error) {
      this.options = previousOptions
      try {
        await this._start(previousPlugin)
      } catch (rollbackError) {
        throw updateError('rollback', legacy, new AggregateError([error, rollbackError]))
      }
      this.context.emit('loader/partial-dispose', this, candidate, true)
      throw updateError('apply', candidate, error)
    }
    commit()
    this.context.emit('loader/partial-dispose', this, legacy, true)
  }

  /**
   * Parse a volatile-only raw config change and commit its values into the running fiber's references.
   * An invalid candidate is logged and leaves the running references unchanged; the raw config stays retained for the next activation.
   * @param fiber - the running fiber whose config references receive the committed values.
   * @param raw - the candidate raw config for this entry.
   * @returns `false` when an ordinary effective value changed, so the caller applies the ordinary update lifecycle.
   */
  private _commitVolatile(fiber: Fiber, raw: unknown): boolean {
    const refs = volatileEntries(fiber.config)
    if (!refs.length) return true
    let candidate: unknown
    try {
      candidate = resolveConfig(fiber.runtime!, fiber.ctx.waterfall(fiber, 'internal/config', raw, () => raw))
    } catch (error) {
      this.ctx.logger.warn('volatile config update failed for %C', this.options.id)
      this.ctx.logger.warn(error)
      return true
    }
    if (!deepEqual(fiber.config, candidate, true)) {
      this.ctx.logger.debug('ordinary config values of %C changed with its volatile values; applying the ordinary update', this.options.id)
      return false
    }
    const paths = refs.flatMap(({ path, ref }) => {
      const source = path.reduce<unknown>((value, key) => Reflect.get(value as object, key), candidate) as Volatile<unknown>
      if (deepEqual(ref.get(), source.get(), true)) return []
      updateVolatile(ref, source)
      return [path]
    })
    if (!paths.length) return true
    const self: Context = Object.create(fiber.ctx)
    // This Cordis hands `ctx.plugin()` a traceable proxy while `ctx.fiber` holds the
    // fiber's own object, so the owning fiber is identified by its registry-unique uid
    // rather than by object identity.
    self[Context.filter] = (owner: Context) => owner.fiber?.uid === fiber.uid
    try {
      fiber.ctx.emit(self, 'loader/volatile-update', paths)
    } catch (error) {
      // A listener failure must not fail the entry update; every value is already committed.
      this.ctx.logger.warn(error)
    }
    return true
  }

  getOuterStack = () => {
    let entry: Entry | undefined = this
    const result: string[] = []
    do {
      result.push(`    at ${entry.parent.tree.ctx.baseUrl}#${entry.options.id}`)
      entry = entry.parent.ctx.fiber.entry
    } while (entry)
    return result
  }

  /** Import and start the configured plugin if it is not already running. */
  async init() {
    try {
      await (this._initTask ??= this._init())
    } finally {
      this._initTask = undefined
      if (!this.loader.getTasks().length) this.ctx.reflect.notify(['loader'])
    }
    await this._await()
  }

  async _await() {
    try {
      await this.fiber?.await()
    } catch (error) {
      throw updateError('apply', this.options, error)
    }
  }

  private async _init() {
    let plugin: any
    let moduleNamespace: unknown
    try {
      moduleNamespace = await this.parent.tree.import(this.options.name, this.getOuterStack)
      plugin = this.loader.unwrapExports(moduleNamespace)
    } catch (error) {
      throw updateError('import', this.options, error)
    }
    try {
      await this._start(plugin)
    } catch (error) {
      throw updateError('apply', this.options, error)
    }
    this.moduleNamespace = moduleNamespace
  }

  private async _start(plugin: any) {
    let fiber: Fiber | undefined
    try {
      await this._patchContext([])
      this.loader.showLog(this, 'apply')
      fiber = this.fiber = this.ctx.registry.plugin(plugin, this.options.config, this.getOuterStack)
      await fiber.await()
    } catch (error) {
      await this._dispose(fiber)
      throw error
    }
  }
}
