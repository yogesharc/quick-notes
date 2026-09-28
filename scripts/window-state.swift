// Dumps what the window server thinks of Quick Notes' windows: level, alpha,
// on-screen, and which Spaces each window belongs to vs the active one.
// Run when the overlay stops floating over full-screen apps, before quitting:
//   swift scripts/window-state.swift
// A healthy overlay is layer 101 and in every Space (or "all"). A window stuck
// in one Space is the Desktop-Space pinning described in src-tauri/src/lib.rs.
import CoreGraphics
import Foundation

typealias ConnFn = @convention(c) () -> Int32
typealias SpacesFn = @convention(c) (Int32, Int32, CFArray) -> Unmanaged<CFArray>?
typealias ActiveFn = @convention(c) (Int32) -> UInt64
typealias DisplaySpacesFn = @convention(c) (Int32) -> Unmanaged<CFArray>?

let sky = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", RTLD_NOW)
let conn = unsafeBitCast(dlsym(sky, "CGSMainConnectionID"), to: ConnFn.self)()
let spacesFor = unsafeBitCast(dlsym(sky, "CGSCopySpacesForWindows"), to: SpacesFn.self)
let active = unsafeBitCast(dlsym(sky, "CGSGetActiveSpace"), to: ActiveFn.self)(conn)

let displaySpaces = unsafeBitCast(dlsym(sky, "CGSCopyManagedDisplaySpaces"), to: DisplaySpacesFn.self)

print("active space: \(active)")
// type 0 = desktop, 4 = full-screen app
for d in displaySpaces(conn)?.takeRetainedValue() as? [[String: Any]] ?? [] {
    let list = (d["Spaces"] as? [[String: Any]] ?? []).map { "\($0["ManagedSpaceID"] ?? "?")(type \($0["type"] ?? "?"))" }
    print("display \(d["Display Identifier"] ?? "?"): \(list.joined(separator: ", "))")
}
let all = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in all where (w[kCGWindowOwnerName as String] as? String) == "quick-notes"
    || (w[kCGWindowOwnerName as String] as? String) == "Quick Notes" {
    let id = w[kCGWindowNumber as String] as! Int
    let spaces = spacesFor(conn, 0x7, [id] as CFArray)?.takeRetainedValue() as? [UInt64] ?? []
    print("""
    window \(id) "\(w[kCGWindowName as String] ?? "")"
      layer \(w[kCGWindowLayer as String] ?? "?")  alpha \(w[kCGWindowAlpha as String] ?? "?")  onscreen \(w[kCGWindowIsOnscreen as String] ?? false)
      bounds \(w[kCGWindowBounds as String] ?? "?")
      spaces \(spaces)  in active: \(spaces.contains(active))
    """)
}
