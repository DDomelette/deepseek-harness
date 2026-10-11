/**
 * qrcode's browser subpath carries no bundled types (@types/qrcode declares
 * only the package root), so declare the one renderer call this package uses.
 */
declare module 'qrcode/lib/browser.js' {
  /** Browser-face QR renderer (canvas/SVG, no Node built-ins). */
  const QRCode: {
    /**
     * Render a QR code as a data URL (PNG by default).
     * @param text - payload text.
     * @param options - renderer options; `margin` sizes the quiet zone in modules.
     * @returns the data URL.
     */
    toDataURL(text: string, options?: { margin?: number }): Promise<string>
  }
  export default QRCode
}
