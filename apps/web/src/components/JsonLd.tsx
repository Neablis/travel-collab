import { serializeJsonLd, type JsonLdNode } from "@/lib/jsonLd";

/** Structured data as a `<script type="application/ld+json">`. Server-rendered; `serializeJsonLd` escapes it. */
export function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
