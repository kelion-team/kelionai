' Pornește puntea de admin ASCUNS (fără fereastră neagră), în fundal.
' Rulat automat la fiecare login prin scurtătura din folderul Startup.
' Log-ul se scrie în bridge.log din acelasi folder (pentru verificare).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\adria\Kelionai\bridge"
sh.Run "cmd /c node kelion-bridge.mjs >> bridge.log 2>&1", 0, False
