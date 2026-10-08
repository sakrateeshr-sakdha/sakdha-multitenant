/**
 * Renders JSON-LD. `undefined` members are dropped by JSON.stringify, which is
 * what the builders in lib/seo.ts rely on to omit optional schema fields.
 */
export function StructuredData({ data }: { data: object | object[] }) {
  const payload = Array.isArray(data) ? data : [data];
  return (
    <>
      {payload.map((d, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d) }}
        />
      ))}
    </>
  );
}
