export default function Note({
  contents,
  onChange,
}: {
  contents: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      className="editor"
      value={contents}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Start writing…"
      spellCheck={false}
      autoFocus
    />
  );
}
