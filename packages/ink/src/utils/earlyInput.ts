let isCapturing = false

export function stopCapturingEarlyInput(): void {
  if (!isCapturing) return
  isCapturing = false
}
