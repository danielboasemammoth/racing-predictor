Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\danie\Desktop\Dans Development Space\racing-predictor\racing-predictor\scripts\windows\run-puntersedge-poll.ps1"" -ProjectRoot ""C:\Users\danie\Desktop\Dans Development Space\racing-predictor\racing-predictor"" -ForceRun", 0, True

