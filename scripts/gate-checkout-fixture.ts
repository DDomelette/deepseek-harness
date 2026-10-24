/**
 * Throwaway repository checkouts and captured gate output for source-ownership
 * gate specs. A spec scans a tree it builds here, so no gate reads the real
 * checkout while that spec runs; {@link removeCheckouts} owns removal from the
 * spec's `afterEach`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { vi } from 'vitest'

const checkouts: string[] = []

/**
 * Write one file into a checkout, creating parent directories.
 * @param root - checkout root returned by {@link createCheckout}.
 * @param rel - repository-relative path inside the checkout.
 * @param content - file text.
 */
export function writeCheckoutFile(root: string, rel: string, content: string): void {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * Build one throwaway checkout holding the given files.
 * @param prefix - `mkdtemp` prefix naming the gate that owns the checkout.
 * @param files - repository-relative path to file text.
 * @returns the checkout root, removed by {@link removeCheckouts}.
 */
export function createCheckout(prefix: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  checkouts.push(root)
  for (const [rel, content] of Object.entries(files)) writeCheckoutFile(root, rel, content)
  return root
}

/** Remove every checkout this spec created; call it from `afterEach`. */
export function removeCheckouts(): void {
  for (const root of checkouts.splice(0)) rmSync(root, { recursive: true, force: true })
}

/**
 * Run a gate with `console.log` and `console.error` captured.
 * @param run - invokes the gate under test with the capturing console installed.
 * @returns the gate's exit code and its captured lines joined by newline.
 */
export function captureGateOutput(run: () => number): { code: number; output: string } {
  const lines: string[] = []
  for (const method of ['log', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(' '))
    })
  }
  const code = run()
  return { code, output: lines.join('\n') }
}
