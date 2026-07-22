// Renders the FloatNotes app icon: Big-Sur-style rounded square (10% margin),
// deep slate gradient, floating note card with text lines.
import AppKit

let size = CGFloat(1024)
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
guard let ctx = NSGraphicsContext.current?.cgContext else { fatalError("no ctx") }

// Transparent canvas; icon body with macOS-style margin + corner radius.
let margin = size * 0.10
let body = CGRect(x: margin, y: margin, width: size - 2 * margin, height: size - 2 * margin)
let radius = body.width * 0.225
let bodyPath = CGPath(roundedRect: body, cornerWidth: radius, cornerHeight: radius, transform: nil)
ctx.addPath(bodyPath)
ctx.clip()

// Gradient: slate-800 -> slate-950.
let colors = [
    CGColor(red: 0.24, green: 0.31, blue: 0.43, alpha: 1),
    CGColor(red: 0.06, green: 0.09, blue: 0.16, alpha: 1),
] as CFArray
let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(
    gradient,
    start: CGPoint(x: body.minX, y: body.maxY),
    end: CGPoint(x: body.maxX, y: body.minY),
    options: [])

// Floating note card, slightly rotated — the "float" in FloatNotes.
ctx.saveGState()
ctx.translateBy(x: size / 2, y: size / 2)
ctx.rotate(by: -0.07)
let cardW = body.width * 0.60
let cardH = body.height * 0.66
let card = CGRect(x: -cardW / 2, y: -cardH / 2, width: cardW, height: cardH)
let cardPath = CGPath(roundedRect: card, cornerWidth: cardW * 0.10, cornerHeight: cardW * 0.10, transform: nil)
ctx.setShadow(offset: CGSize(width: 0, height: -size * 0.02), blur: size * 0.05,
              color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.45))
ctx.setFillColor(CGColor(red: 0.98, green: 0.97, blue: 0.94, alpha: 1))
ctx.addPath(cardPath)
ctx.fillPath()
ctx.setShadow(offset: .zero, blur: 0, color: nil)

// Text lines: one amber title line, three gray body lines.
let inset = cardW * 0.14
let lineH = cardH * 0.055
let gap = cardH * 0.155
var y = card.maxY - inset - lineH
func line(_ width: CGFloat, _ color: CGColor) {
    let r = CGRect(x: card.minX + inset, y: y, width: width, height: lineH)
    ctx.setFillColor(color)
    ctx.addPath(CGPath(roundedRect: r, cornerWidth: lineH / 2, cornerHeight: lineH / 2, transform: nil))
    ctx.fillPath()
    y -= gap
}
line(cardW * 0.45, CGColor(red: 0.96, green: 0.68, blue: 0.16, alpha: 1))
line(cardW * 0.72, CGColor(red: 0.65, green: 0.66, blue: 0.68, alpha: 1))
line(cardW * 0.72, CGColor(red: 0.65, green: 0.66, blue: 0.68, alpha: 1))
line(cardW * 0.52, CGColor(red: 0.65, green: 0.66, blue: 0.68, alpha: 1))
ctx.restoreGState()

image.unlockFocus()

let dest = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-source.png"
guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else { fatalError("encode failed") }
try! png.write(to: URL(fileURLWithPath: dest))
print("wrote \(dest)")
