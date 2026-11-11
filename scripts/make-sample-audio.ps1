<#
  Generates a short spoken sample for the transcription check.
  Windows PowerShell only; the voice is not Pidgin, but the words are.
#>
param(
  [string]$Out = ".shots/ai-sample.wav"
)

Add-Type -AssemblyName System.Speech

$full = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Out))
$dir = [System.IO.Path]::GetDirectoryName($full)
if ($dir) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -1
$synth.SetOutputToWaveFile($full)
$synth.Speak("Ah, wetin happen to the Friday payout? E be like the bank dey slow us down, the file reach them late. No wahala, make we pause the same-day promise until the cutoff hold. I go send the merchant note before four.")
$synth.Dispose()

Write-Output $Out
