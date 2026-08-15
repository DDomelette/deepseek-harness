/**
 * Session-reference plugin, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host composition; the browser half
 * ships via exports["./client"] and the package.json dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this source plugin. */
export function apply(): void {}
