@echo off
cd /d f:\project\Blog\worker
powershell -ExecutionPolicy Bypass -File scripts\upload-images.ps1
pause
