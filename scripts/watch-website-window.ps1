param([Parameter(Mandatory = $true)][int]$BrowserProcessId)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WebsiteWindow {
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr handle);
}
'@

try {
    $browser = Get-Process -Id $BrowserProcessId -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(30)
    $window = [IntPtr]::Zero
    do {
        $browser.Refresh()
        if ($browser.HasExited) { throw 'Browser exited before opening its website window.' }
        $window = $browser.MainWindowHandle
        if ($window -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    if ($window -eq [IntPtr]::Zero) { throw 'Website window did not open within 30 seconds.' }
    Write-Output 'WINDOW_READY'
    # Track the original window handle. Extra product windows must not keep the
    # website/model processes alive after the main app window has been closed.
    while ([WebsiteWindow]::IsWindow($window)) { Start-Sleep -Milliseconds 250 }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
