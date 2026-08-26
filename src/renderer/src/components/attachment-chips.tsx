import { X } from 'lucide-react'
import type { ImageAttachment } from '@shared/attachments'
import { Button } from '@/components/ui/button'

type Props = {
  images: ImageAttachment[]
  onRemove: (index: number) => void
}

/** Thumbnails of what will go with the next prompt. */
export function AttachmentChips({ images, onRemove }: Props): React.JSX.Element | null {
  if (images.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image, i) => (
        <div
          key={`${image.name}-${i}`}
          className="relative flex items-center gap-2 rounded-md border border-border bg-muted/40 p-1 pr-2"
        >
          <img
            src={`data:${image.mediaType};base64,${image.data}`}
            alt={image.name}
            className="size-10 rounded object-cover"
          />
          <span className="max-w-40 truncate text-xs text-muted-foreground">{image.name}</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            aria-label={`Remove ${image.name}`}
            onClick={() => onRemove(i)}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  )
}
