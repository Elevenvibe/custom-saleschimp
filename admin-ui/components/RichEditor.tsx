"use client";

/**
 * RichEditor — tiptap-backed WYSIWYG used for ticket replies + mail
 * compose/reply. Outputs HTML on every change via `onChange(html)`.
 *
 * Why tiptap and not a textarea + markdown? Because the user explicitly
 * asked for "WYSIWYG" — they expect bold/italic/lists/links/headings
 * to render *while typing*. Tiptap is the smallest React-native option
 * that gives us that without dragging in Quill's stylesheet conflicts
 * or TinyMCE's bundle size.
 *
 * Sanitisation happens on the read side (HtmlBody) via DOMPurify so we
 * don't have to trust the editor output. The toolbar is intentionally
 * lean — bold/italic/strike/H2/H3/lists/link — to keep the markup
 * narrow enough that the sanitiser whitelist barely needs widening.
 */

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Heading2,
  Heading3,
  Quote,
} from "lucide-react";
import { useEffect } from "react";

export function RichEditor({
  value,
  onChange,
  placeholder,
  minHeight = 120,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        // openOnClick=false so clicking a link inside the editor
        // doesn't navigate the parent away from the page mid-edit.
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Type your message…",
      }),
    ],
    // SSR-safe — Tiptap throws if it mounts on the server with no DOM.
    // Next.js calls this in a "use client" component so we're fine, but
    // immediatelyRender=false defers the first paint to after hydration
    // which avoids a hydration warning if the parent renders during SSR.
    immediatelyRender: false,
    content: value,
    editorProps: {
      attributes: {
        // ProseMirror's default outline interferes with the surrounding
        // form's focus styles; suppress and lean on the wrapper's border.
        class:
          "prose prose-sm max-w-none focus:outline-none [&_p]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // Tiptap returns "<p></p>" for an empty doc — normalize to ""
      // so callers can do truthiness checks for "is this empty".
      onChange(html === "<p></p>" ? "" : html);
    },
  });

  // Keep editor content in sync with external value resets (e.g. after
  // a successful submit clears the form). Comparing getHTML avoids a
  // loop where setContent fires onUpdate which sets value which we'd
  // then react to.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value && (value || "") !== "") {
      editor.commands.setContent(value || "", false);
    } else if ((value || "") === "" && editor.getHTML() !== "<p></p>") {
      editor.commands.clearContent();
    }
  }, [editor, value]);

  if (!editor) {
    return (
      <div
        className="rounded-md border bg-background text-sm text-muted-foreground p-3"
        style={{ minHeight }}
      >
        Loading editor…
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="px-3 py-2" style={{ minHeight }} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const Btn = ({
    onClick,
    isActive,
    title,
    children,
  }: {
    onClick: () => void;
    isActive?: boolean;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-7 w-7 inline-flex items-center justify-center rounded text-xs hover:bg-muted ${
        isActive ? "bg-muted text-foreground" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );

  function promptLink() {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (leave blank to remove):", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
      <Btn
        title="Bold (⌘B)"
        isActive={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        title="Italic (⌘I)"
        isActive={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        title="Strikethrough"
        isActive={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </Btn>
      <div className="mx-1 h-4 w-px bg-border" />
      <Btn
        title="Heading 2"
        isActive={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        title="Heading 3"
        isActive={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-3.5 w-3.5" />
      </Btn>
      <div className="mx-1 h-4 w-px bg-border" />
      <Btn
        title="Bulleted list"
        isActive={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        title="Numbered list"
        isActive={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        title="Quote"
        isActive={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-3.5 w-3.5" />
      </Btn>
      <div className="mx-1 h-4 w-px bg-border" />
      <Btn
        title="Link"
        isActive={editor.isActive("link")}
        onClick={promptLink}
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </Btn>
    </div>
  );
}
