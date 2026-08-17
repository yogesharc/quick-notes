import { MOD_KEY } from "../lib/format";

export default function Shortcut({ letter }: { letter: string }) {
  return (
    <kbd className="kbd">
      {MOD_KEY}
      {letter}
    </kbd>
  );
}
