export function Chip({ on, label, title, onClick }: { on: boolean; label: string; title?: string; onClick: () => void }) {
  return (
    <button class={`chip${on ? ' on' : ''}`} title={title} onClick={onClick}>
      {label}
    </button>
  );
}
