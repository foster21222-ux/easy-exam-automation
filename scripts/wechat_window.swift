import AppKit
import CoreGraphics
import Foundation

func mainWindow() -> (id: Int, bounds: CGRect)? {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
  for window in windows {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    let layer = window[kCGWindowLayer as String] as? Int ?? -1
    guard layer == 0, owner.localizedCaseInsensitiveContains("WeChat") || owner.contains("微信") else { continue }
    guard let id = window[kCGWindowNumber as String] as? Int,
          let boundsValue = window[kCGWindowBounds as String],
          let bounds = CGRect(dictionaryRepresentation: boundsValue as! CFDictionary) else { continue }
    return (id, bounds)
  }
  return nil
}

guard let window = mainWindow() else {
  fputs("未找到可见微信主窗口\n", stderr)
  exit(1)
}

func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags = []) {
  let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true)
  down?.flags = flags
  down?.post(tap: .cghidEventTap)
  let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
  up?.flags = flags
  up?.post(tap: .cghidEventTap)
  usleep(100_000)
}

func clickSearch(_ bounds: CGRect) {
  let point = CGPoint(x: bounds.origin.x + 152, y: bounds.origin.y + 27)
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(100_000)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

switch CommandLine.arguments.dropFirst().first ?? "info" {
case "info":
  let bounds = window.bounds
  print("\(window.id),\(Int(bounds.origin.x)),\(Int(bounds.origin.y)),\(Int(bounds.width)),\(Int(bounds.height))")
case "click-search":
  clickSearch(window.bounds)
case "open-group":
  guard CommandLine.arguments.count >= 3 else {
    fputs("缺少微信群名称\n", stderr)
    exit(2)
  }
  NSPasteboard.general.clearContents()
  NSPasteboard.general.setString(CommandLine.arguments[2], forType: .string)
  guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.tencent.xinWeChat").first else {
    fputs("微信未运行\n", stderr)
    exit(1)
  }
  app.activate(options: [])
  usleep(500_000)
  clickSearch(window.bounds)
  postKey(0, flags: .maskCommand)
  postKey(9, flags: .maskCommand)
  usleep(800_000)
  postKey(36)
  usleep(800_000)
default:
  fputs("用法：swift scripts/wechat_window.swift [info|click-search|open-group 群名]\n", stderr)
  exit(2)
}
