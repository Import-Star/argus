export function Icon({ d, size = 14, stroke = 2 }: { d: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
