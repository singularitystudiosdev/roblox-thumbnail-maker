interface ReferenceCardProps {
  name: string
  url: string
}

export function ReferenceCard({ name, url }: ReferenceCardProps) {
  return (
    <section aria-labelledby="reference-title" className="flex flex-col gap-12 rounded-16 border border-border-default bg-bg-surface p-16">
      <div className="flex flex-col gap-4">
        <h2 id="reference-title" className="text-title font-semibold">Reference image</h2>
        <p className="text-caption text-text-secondary">Attached to every generation as the style to copy.</p>
      </div>
      <img src={url} alt={`Reference thumbnail: ${name}`} width={768} height={432} className="aspect-video w-full rounded-8 object-cover" />
      <span className="text-label text-text-secondary">{name}</span>
    </section>
  )
}
