# Opens a folder in Explorer and brings its window to the front: the window already open on that folder, or a new
# one. Windows keeps a window opened by a background process behind the others (the foreground lock), so the window
# is lifted above the rest with SetWindowPos (topmost, then not), which the lock does not stop, and given the focus
# through the foreground thread's input queue.
param([Parameter(Mandatory)][string]$Path)

$Path = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\')
$shell = New-Object -ComObject Shell.Application

function Find-Window {
  $shell.Windows() | Where-Object {
    try { $_.Document.Folder.Self.Path.TrimEnd('\') -eq $Path } catch { $false }
  } | Select-Object -First 1
}

$window = Find-Window
if (-not $window) {
  $shell.Open($Path)
  for ($i = 0; $i -lt 30 -and -not $window; $i++) {
    Start-Sleep -Milliseconds 100
    $window = Find-Window
  }
}
if (-not $window) { exit 1 }

Add-Type -Namespace Claudify -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, System.IntPtr pid);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
'@
$hwnd = [System.IntPtr]$window.HWND
$noMoveNoSize = 0x0001 -bor 0x0002 -bor 0x0040
[void][Claudify.Win]::ShowWindow($hwnd, 9)
# Above every window, then back among them: it stays on top of what was there.
[void][Claudify.Win]::SetWindowPos($hwnd, [System.IntPtr](-1), 0, 0, 0, 0, $noMoveNoSize)
[void][Claudify.Win]::SetWindowPos($hwnd, [System.IntPtr](-2), 0, 0, 0, 0, $noMoveNoSize)
# The focus: borrowed from the thread that has it.
$foreground = [Claudify.Win]::GetWindowThreadProcessId([Claudify.Win]::GetForegroundWindow(), [System.IntPtr]::Zero)
$me = [Claudify.Win]::GetCurrentThreadId()
[void][Claudify.Win]::AttachThreadInput($me, $foreground, $true)
[void][Claudify.Win]::BringWindowToTop($hwnd)
[void][Claudify.Win]::SetForegroundWindow($hwnd)
[void][Claudify.Win]::AttachThreadInput($me, $foreground, $false)
