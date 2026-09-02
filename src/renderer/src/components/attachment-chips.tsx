import { Atom, File, FileArchive, FileCode, FileImage, FileJson, FileText, X } from 'lucide-react'
import type { ImageAttachment } from '@shared/attachments'
import {
  baseName,
  fileIconKind,
  type FileAttachment,
  type FileIconKind
} from '@shared/file-attachments'
import { Button } from '@/components/ui/button'

type Props = {
  images: ImageAttachment[]
  files: FileAttachment[]
  onRemove: (index: number) => void
  onRemoveFile: (index: number) => void
}

const ICONS: Record<FileIconKind, typeof File> = {
  react: Atom,
  code: FileCode,
  data: FileJson,
  text: FileText,
  image: FileImage,
  archive: FileArchive,
  file: File
}

/** What will go with the next prompt: image thumbnails and file chips. */
export function AttachmentChips({
  images,
  files,
  onRemove,
  onRemoveFile
}: Props): React.JSX.Element | null {
  if (images.length === 0 && files.length === 0) return null
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
      {files.map((file, i) => {
        const name = baseName(file.path)
        const Icon = ICONS[fileIconKind(name)]
        return (
          <div
            key={file.path}
            // The chip shows the name; the full path waits on the tooltip,
            // where it answers "which app.tsx" without eating the row.
            title={file.path}
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-40 truncate text-xs">{name}</span>
            <Button
              size="icon"
              variant="ghost"
              className="size-5"
              aria-label={`Remove ${name}`}
              onClick={() => onRemoveFile(i)}
            >
              <X className="size-3" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
