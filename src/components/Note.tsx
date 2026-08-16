export default function Note({
  contents,
  onChange,
}: {
  contents: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      value={contents}
      onChange={(e) => onChange(e.target.value)}
      autoFocus
    />
  );
}
