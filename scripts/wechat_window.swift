import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import Vision

func mainWindow() -> (id: Int, pid: pid_t, bounds: CGRect)? {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
  var candidates: [(id: Int, pid: pid_t, bounds: CGRect)] = []
  for window in windows {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    let layer = window[kCGWindowLayer as String] as? Int ?? -1
    guard layer == 0, owner.localizedCaseInsensitiveContains("WeChat") || owner.contains("微信") else { continue }
    guard let id = window[kCGWindowNumber as String] as? Int,
          let pid = window[kCGWindowOwnerPID as String] as? pid_t,
          let boundsValue = window[kCGWindowBounds as String],
          let bounds = CGRect(dictionaryRepresentation: boundsValue as! CFDictionary) else { continue }
    candidates.append((id, pid, bounds))
  }
  return candidates.max { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }
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

func isWeChatApplication(_ app: NSRunningApplication?) -> Bool {
  guard let app else { return false }
  return app.bundleIdentifier == "com.tencent.xinWeChat"
    || app.localizedName?.localizedCaseInsensitiveContains("WeChat") == true
    || app.localizedName?.contains("微信") == true
}

func activateWeChat() {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  process.arguments = ["-a", "WeChat"]
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fputs("无法激活微信：\(error.localizedDescription)\n", stderr)
    exit(1)
  }
  if process.terminationStatus != 0 {
    fputs("无法激活微信\n", stderr)
    exit(1)
  }
  let apps = NSWorkspace.shared.runningApplications.filter { app in
    isWeChatApplication(app)
  }
  for app in apps {
    app.unhide()
    app.activate(options: [.activateAllWindows])
  }
  let deadline = Date().addingTimeInterval(5)
  while Date() < deadline {
    if isWeChatApplication(NSWorkspace.shared.frontmostApplication) {
      return
    }
    usleep(100_000)
  }
  if mainWindow() != nil {
    return
  }
  fputs("无法将微信切到前台\n", stderr)
  exit(1)
}

func click(_ point: CGPoint) {
  let source = CGEventSource(stateID: .hidSystemState)
  source?.localEventsSuppressionInterval = 0
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(100_000)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(80_000)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func clickWithFreshProcess(_ point: CGPoint) {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/swift")
  process.arguments = [
    CommandLine.arguments[0],
    "click-point-delayed",
    "\(Int(point.x.rounded()))",
    "\(Int(point.y.rounded()))",
  ]
  debugLog("click child args=\(process.arguments?.joined(separator: " ") ?? "")")
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fputs("无法点击微信会话：\(error.localizedDescription)\n", stderr)
    exit(1)
  }
  if process.terminationStatus != 0 {
    fputs("点击微信会话失败\n", stderr)
    exit(1)
  }
}

func clickSearch(_ bounds: CGRect) {
  click(CGPoint(x: bounds.origin.x + 152, y: bounds.origin.y + 27))
}

func scrollChat(direction: String, in bounds: CGRect, lines: Int = 48, bursts: Int = 4) {
  activateWeChat()
  let source = CGEventSource(stateID: .hidSystemState)
  source?.localEventsSuppressionInterval = 0
  let point = CGPoint(x: bounds.origin.x + bounds.width * 0.68, y: bounds.origin.y + bounds.height * 0.52)
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(80_000)
  let lineDelta = Int32(lines)
  let delta = direction == "down" ? -lineDelta : lineDelta
  for _ in 0..<bursts {
    CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
    usleep(90_000)
  }
  usleep(500_000)
}

func resizeWindow(width: Int, height: Int, window: (id: Int, pid: pid_t, bounds: CGRect)) {
  activateWeChat()
  guard AXIsProcessTrusted() else {
    fputs("需要授予辅助功能权限后才能自动调整微信窗口大小\n", stderr)
    exit(1)
  }
  let appElement = AXUIElementCreateApplication(window.pid)
  var axWindowValue: CFTypeRef?
  var axResult = AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &axWindowValue)
  if axResult != .success || axWindowValue == nil {
    var windowsValue: CFTypeRef?
    axResult = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsValue)
    if axResult == .success,
       let windows = windowsValue as? [AXUIElement],
       let firstWindow = windows.first {
      axWindowValue = firstWindow
    }
  }
  guard let axWindowValue else {
    fputs("无法定位微信主窗口，不能自动调整大小\n", stderr)
    exit(1)
  }
  let axWindow = axWindowValue as! AXUIElement
  var position = CGPoint(x: window.bounds.origin.x, y: window.bounds.origin.y)
  var size = CGSize(width: max(CGFloat(width), window.bounds.width), height: max(CGFloat(height), window.bounds.height))
  guard let positionValue = AXValueCreate(.cgPoint, &position),
        let sizeValue = AXValueCreate(.cgSize, &size) else {
    fputs("无法生成微信窗口尺寸参数\n", stderr)
    exit(1)
  }
  AXUIElementSetAttributeValue(axWindow, kAXPositionAttribute as CFString, positionValue)
  let resizeResult = AXUIElementSetAttributeValue(axWindow, kAXSizeAttribute as CFString, sizeValue)
  if resizeResult != .success {
    fputs("自动调整微信窗口大小失败：\(resizeResult.rawValue)\n", stderr)
    exit(1)
  }
  usleep(800_000)
}

func normalized(_ text: String) -> String {
  text.replacingOccurrences(of: " ", with: "")
    .replacingOccurrences(of: "\n", with: "")
    .replacingOccurrences(of: "…", with: "")
    .lowercased()
    .replacingOccurrences(of: "l", with: "i")
}

func commonPrefixLength(_ left: String, _ right: String) -> Int {
  var count = 0
  for (a, b) in zip(left, right) {
    if a != b { break }
    count += 1
  }
  return count
}

func textMatchesGroup(_ text: String, groupName: String) -> Bool {
  let candidate = normalized(text)
  let target = normalized(groupName)
  if candidate.isEmpty || target.isEmpty { return false }
  if candidate.contains(target) || target.contains(candidate) { return true }
  return commonPrefixLength(candidate, target) >= min(6, target.count)
}

func debugLog(_ message: String) {
  if ProcessInfo.processInfo.environment["WECHAT_WINDOW_DEBUG"] == "1" {
    fputs("\(message)\n", stderr)
  }
}

func clickVisibleConversation(_ groupName: String, in window: (id: Int, pid: pid_t, bounds: CGRect), clearSearch: Bool = false) -> Bool {
  let screenshotURL = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("easy-exam-wechat-window-\(window.id)-\(UUID().uuidString).png")
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  process.arguments = ["-x", "-o", "-l\(window.id)", screenshotURL.path]
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fputs("无法截图微信窗口用于定位会话列表：\(error.localizedDescription)\n", stderr)
    exit(1)
  }
  guard process.terminationStatus == 0,
        let source = CGImageSourceCreateWithURL(screenshotURL as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    try? FileManager.default.removeItem(at: screenshotURL)
    fputs("无法读取微信窗口截图用于定位会话列表\n", stderr)
    exit(1)
  }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["zh-Hans", "en-US"]
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  do {
    try handler.perform([request])
  } catch {
    try? FileManager.default.removeItem(at: screenshotURL)
    fputs("无法识别微信会话列表文字：\(error.localizedDescription)\n", stderr)
    exit(1)
  }
  try? FileManager.default.removeItem(at: screenshotURL)

  let imageWidth = CGFloat(image.width)
  let imageHeight = CGFloat(image.height)
  let matches = (request.results ?? []).compactMap { observation -> (text: String, rect: CGRect)? in
    guard let text = observation.topCandidates(1).first?.string, textMatchesGroup(text, groupName: groupName) else {
      return nil
    }
    let box = observation.boundingBox
    let rect = CGRect(
      x: box.minX * imageWidth,
      y: (1 - box.maxY) * imageHeight,
      width: box.width * imageWidth,
      height: box.height * imageHeight
    )
    guard rect.minX >= 55, rect.maxX <= 300, rect.minY >= 55 else { return nil }
    return (text, rect)
  }
  guard let match = matches.min(by: { $0.rect.minY < $1.rect.minY }) else {
    return false
  }
  let point = CGPoint(x: window.bounds.origin.x + 150, y: window.bounds.origin.y + match.rect.midY)
  debugLog("matched conversation text=\(match.text) rect=\(Int(match.rect.minX)),\(Int(match.rect.minY)),\(Int(match.rect.width)),\(Int(match.rect.height)) point=\(Int(point.x)),\(Int(point.y))")
  if clearSearch {
    postKey(53)
    usleep(300_000)
  }
  clickWithFreshProcess(point)
  return true
}

switch CommandLine.arguments.dropFirst().first ?? "info" {
case "info":
  let bounds = window.bounds
  print("\(window.id),\(Int(bounds.origin.x)),\(Int(bounds.origin.y)),\(Int(bounds.width)),\(Int(bounds.height))")
case "click-search":
  clickSearch(window.bounds)
case "scroll-chat":
  guard CommandLine.arguments.count >= 3 else {
    fputs("缺少滚动方向\n", stderr)
    exit(2)
  }
  let lines = CommandLine.arguments.count >= 4 ? Int(CommandLine.arguments[3]) ?? 48 : 48
  let bursts = CommandLine.arguments.count >= 5 ? Int(CommandLine.arguments[4]) ?? 4 : 4
  scrollChat(direction: CommandLine.arguments[2], in: window.bounds, lines: lines, bursts: bursts)
case "resize-window":
  guard CommandLine.arguments.count >= 4,
        let width = Int(CommandLine.arguments[2]),
        let height = Int(CommandLine.arguments[3]) else {
    fputs("缺少目标窗口宽高\n", stderr)
    exit(2)
  }
  resizeWindow(width: width, height: height, window: window)
case "click-point":
  guard CommandLine.arguments.count >= 4,
        let x = Double(CommandLine.arguments[2]),
        let y = Double(CommandLine.arguments[3]) else {
    fputs("缺少点击坐标\n", stderr)
    exit(2)
  }
  activateWeChat()
  click(CGPoint(x: x, y: y))
  usleep(500_000)
case "click-point-delayed":
  guard CommandLine.arguments.count >= 4,
        let x = Double(CommandLine.arguments[2]),
        let y = Double(CommandLine.arguments[3]) else {
    fputs("缺少点击坐标\n", stderr)
    exit(2)
  }
  usleep(800_000)
  activateWeChat()
  click(CGPoint(x: x, y: y))
  usleep(500_000)
case "open-group":
  guard CommandLine.arguments.count >= 3 else {
    fputs("缺少微信群名称\n", stderr)
    exit(2)
  }
  NSPasteboard.general.clearContents()
  NSPasteboard.general.setString(CommandLine.arguments[2], forType: .string)
  activateWeChat()
  usleep(500_000)
  postKey(53)
  usleep(300_000)
  guard let activeWindow = mainWindow() else {
    fputs("未找到可见微信主窗口\n", stderr)
    exit(1)
  }
  if !clickVisibleConversation(CommandLine.arguments[2], in: activeWindow) {
    clickSearch(activeWindow.bounds)
    postKey(0, flags: .maskCommand)
    postKey(9, flags: .maskCommand)
    usleep(300_000)
    postKey(36)
    usleep(1_200_000)
    if !clickVisibleConversation(CommandLine.arguments[2], in: activeWindow, clearSearch: true) {
      fputs("未在左侧会话列表找到目标群：\(CommandLine.arguments[2])\n", stderr)
      exit(1)
    }
  }
default:
  fputs("用法：swift scripts/wechat_window.swift [info|click-search|scroll-chat up|down [lines] [bursts]|resize-window width height|open-group 群名]\n", stderr)
  exit(2)
}
