import { useEffect, useRef } from 'react';

/**
 * 6-digit OTP input. Controlled component.
 * Props:
 *   value (string) — current value, up to 6 digits
 *   onChange (string) — called with new value as user types
 *   onComplete () — optional, called when 6 digits are entered
 *   disabled (bool)
 *   autoFocus (bool) — focus first empty box on mount
 */
export default function OtpInput({ value, onChange, onComplete, disabled = false, autoFocus = true }) {
  const inputsRef = useRef([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  useEffect(() => {
    if (autoFocus) {
      const focusIdx = Math.min(value.length, 5);
      inputsRef.current[focusIdx]?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value.length === 6 && onComplete) onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const setDigitAt = (idx, ch) => {
    const clean = ch.replace(/\D/g, '').slice(0, 1);
    const arr = value.padEnd(6, ' ').slice(0, 6).split('');
    arr[idx] = clean || ' ';
    const next = arr.join('').replaceAll(' ', '');
    onChange(next);
    if (clean && idx < 5) inputsRef.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === 'Backspace') {
      const arr = value.padEnd(6, ' ').slice(0, 6).split('');
      if (arr[idx] && arr[idx] !== ' ') {
        arr[idx] = ' ';
        onChange(arr.join('').replaceAll(' ', ''));
      } else if (idx > 0) {
        inputsRef.current[idx - 1]?.focus();
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && idx < 5) {
      inputsRef.current[idx + 1]?.focus();
      e.preventDefault();
    }
  };

  const handlePaste = (e) => {
    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (pasted.length > 0) {
      onChange(pasted);
      inputsRef.current[Math.min(pasted.length, 5)]?.focus();
      e.preventDefault();
    }
  };

  return (
    <div className="otp-input-row" onPaste={handlePaste}>
      {digits.map((d, idx) => (
        <input
          key={idx}
          ref={(el) => (inputsRef.current[idx] = el)}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          className="otp-digit"
          value={d.trim()}
          onChange={(e) => setDigitAt(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          disabled={disabled}
          autoComplete="one-time-code"
        />
      ))}
    </div>
  );
}