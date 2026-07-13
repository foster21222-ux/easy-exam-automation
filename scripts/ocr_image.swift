#!/usr/bin/env swift
import Foundation
import ImageIO
import Vision

if CommandLine.arguments.count < 2 {
  FileHandle.standardError.write(Data("usage: ocr_image.swift [--template-bounds|--rect-normalized x y w h|--mark-normalized x y w h] /path/to/image\n".utf8))
  exit(2)
}

var mode = "ocr"
var rectValues: [Double] = []
var imagePath = CommandLine.arguments[1]
if CommandLine.arguments.count >= 3 && CommandLine.arguments[1] == "--template-bounds" {
  mode = "bounds"
  imagePath = CommandLine.arguments[2]
} else if CommandLine.arguments.count >= 7 && (CommandLine.arguments[1] == "--rect-normalized" || CommandLine.arguments[1] == "--mark-normalized") {
  mode = CommandLine.arguments[1] == "--mark-normalized" ? "mark" : "ocr"
  rectValues = CommandLine.arguments[2...5].compactMap { Double($0) }
  imagePath = CommandLine.arguments[6]
  if rectValues.count != 4 {
    FileHandle.standardError.write(Data("invalid normalized rect\n".utf8))
    exit(2)
  }
}
let imageURL = URL(fileURLWithPath: imagePath)

guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      var image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  FileHandle.standardError.write(Data("failed to read image: \(imagePath)\n".utf8))
  exit(1)
}

if rectValues.count == 4 {
  let width = Double(image.width)
  let height = Double(image.height)
  let x = max(0, min(width - 1, rectValues[0] * width))
  let y = max(0, min(height - 1, rectValues[1] * height))
  let w = max(1, min(width - x, rectValues[2] * width))
  let h = max(1, min(height - y, rectValues[3] * height))
  let rect = CGRect(x: Int(x.rounded()), y: Int(y.rounded()), width: Int(w.rounded()), height: Int(h.rounded()))
  guard let cropped = image.cropping(to: rect) else {
    FileHandle.standardError.write(Data("failed to crop image\n".utf8))
    exit(1)
  }
  image = cropped
}

func rgbaPixels(_ image: CGImage) -> [UInt8]? {
  let width = image.width
  let height = image.height
  let bytesPerPixel = 4
  let bytesPerRow = width * bytesPerPixel
  var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
  guard let context = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    return nil
  }
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  return pixels
}

if mode == "bounds" {
  let width = image.width
  let height = image.height
  let bytesPerPixel = 4
  let bytesPerRow = width * bytesPerPixel
  guard let pixels = rgbaPixels(image) else {
    FileHandle.standardError.write(Data("failed to create image context\n".utf8))
    exit(1)
  }
  var rowCounts = [Int](repeating: 0, count: height)
  var columnCounts = [Int](repeating: 0, count: width)
  for y in 0..<height {
    for x in 0..<width {
      let offset = y * bytesPerRow + x * bytesPerPixel
      let r = Int(pixels[offset])
      let g = Int(pixels[offset + 1])
      let b = Int(pixels[offset + 2])
      let isTemplateBlue = b > 150 && g > 120 && b > r + 35
      if isTemplateBlue {
        rowCounts[y] += 1
        columnCounts[x] += 1
      }
    }
  }
  let horizontalLineThreshold = max(80, Int(Double(width) * 0.25))
  let verticalLineThreshold = max(80, Int(Double(height) * 0.25))
  let horizontalRows = rowCounts.enumerated().filter { $0.element >= horizontalLineThreshold }.map { $0.offset }
  let verticalColumns = columnCounts.enumerated().filter { $0.element >= verticalLineThreshold }.map { $0.offset }
  if horizontalRows.isEmpty || verticalColumns.isEmpty {
    print("{\"tableX\":0,\"tableY\":0,\"tableWidth\":1,\"tableHeight\":1,\"imageWidth\":\(width),\"imageHeight\":\(height),\"detected\":false}")
  } else {
    let minX = verticalColumns.min() ?? 0
    let maxX = verticalColumns.max() ?? (width - 1)
    let minY = horizontalRows.min() ?? 0
    let maxY = horizontalRows.max() ?? (height - 1)
    let normalizedX = Double(minX) / Double(width)
    let normalizedY = Double(minY) / Double(height)
    let normalizedWidth = Double(maxX - minX + 1) / Double(width)
    let normalizedHeight = Double(maxY - minY + 1) / Double(height)
    print("{\"tableX\":\(normalizedX),\"tableY\":\(normalizedY),\"tableWidth\":\(normalizedWidth),\"tableHeight\":\(normalizedHeight),\"imageWidth\":\(width),\"imageHeight\":\(height),\"detected\":true}")
  }
  exit(0)
}

if mode == "mark" {
  let width = image.width
  let height = image.height
  let bytesPerPixel = 4
  guard let pixels = rgbaPixels(image) else {
    FileHandle.standardError.write(Data("failed to create image context\n".utf8))
    exit(1)
  }
  var dark = 0
  var nonWhite = 0
  let total = max(1, width * height)
  for offset in stride(from: 0, to: pixels.count, by: bytesPerPixel) {
    let r = Int(pixels[offset])
    let g = Int(pixels[offset + 1])
    let b = Int(pixels[offset + 2])
    let average = (r + g + b) / 3
    if average < 140 { dark += 1 }
    if average < 235 { nonWhite += 1 }
  }
  print("{\"darkRatio\":\(Double(dark) / Double(total)),\"nonWhiteRatio\":\(Double(nonWhite) / Double(total)),\"width\":\(width),\"height\":\(height)}")
  exit(0)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: image, options: [:])
do {
  try handler.perform([request])
  let lines = (request.results ?? [])
    .compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
  print(lines.joined(separator: "\n"))
} catch {
  FileHandle.standardError.write(Data("ocr failed: \(error.localizedDescription)\n".utf8))
  exit(1)
}
