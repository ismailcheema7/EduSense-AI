Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
batPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "activate.bat")
' 0 = hidden window, False = do not wait
sh.Run Chr(34) & batPath & Chr(34), 0, False
