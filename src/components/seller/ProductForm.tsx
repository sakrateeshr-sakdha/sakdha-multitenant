"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { createProduct, updateProduct, type ProductInput } from "@/lib/actions/products";
import { toPaise } from "@/lib/money";

export type CategoryOption = { id: string; name: string; parentName: string | null };

export type ProductFormValues = {
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  categoryId: string;
  /** Rupees, as typed. Converted to paise on submit. */
  price: string;
  compareAtPrice: string;
  gender: string;
  fabric: string;
  pattern: string;
  fit: string;
  occasion: string;
  washCare: string;
  weightGrams: string;
  seoTitle: string;
  seoDescription: string;
};

export const EMPTY_PRODUCT: ProductFormValues = {
  name: "", slug: "", shortDescription: "", description: "", categoryId: "",
  price: "", compareAtPrice: "", gender: "", fabric: "", pattern: "", fit: "",
  occasion: "", washCare: "", weightGrams: "", seoTitle: "", seoDescription: "",
};

const slugify = (value: string) =>
  value.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);

const GENDERS = ["", "women", "men", "kids", "unisex"];

export function ProductForm({
  categories,
  productId,
  initial = EMPTY_PRODUCT,
}: {
  categories: CategoryOption[];
  productId?: string;
  initial?: ProductFormValues;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<ProductFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  // Once a product exists its slug is a public URL, so never auto-rewrite it.
  const [slugEdited, setSlugEdited] = useState(Boolean(productId));

  const set =
    (key: keyof ProductFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "name" && !slugEdited) next.slug = slugify(value);
        return next;
      });
    };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const rupees = (v: string) => (v.trim() === "" ? null : toPaise(Number(v)));
    const price = rupees(form.price);
    if (price == null || Number.isNaN(price)) {
      setErrors({ price: ["Enter a price."] });
      return;
    }

    const payload: ProductInput = {
      name: form.name,
      slug: form.slug,
      shortDescription: form.shortDescription,
      description: form.description,
      categoryId: form.categoryId || null,
      price,
      compareAtPrice: rupees(form.compareAtPrice),
      gender: form.gender,
      fabric: form.fabric,
      pattern: form.pattern,
      fit: form.fit,
      occasion: form.occasion,
      washCare: form.washCare,
      weightGrams: form.weightGrams.trim() === "" ? null : Number(form.weightGrams),
      seoTitle: form.seoTitle,
      seoDescription: form.seoDescription,
    };

    // Kept as two branches rather than one: only createProduct returns an id,
    // and collapsing them would mean casting the union back apart.
    startTransition(async () => {
      if (productId) {
        const result = await updateProduct(productId, payload);
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          toast.error(result.error);
          return;
        }
        toast.success("Saved");
        router.refresh();
        return;
      }

      const result = await createProduct(payload);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("Draft created — add photos next");
      router.push(`/seller/products/${result.productId}`);
    });
  };

  const inputCls =
    "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600/30";
  const areaCls =
    "w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600/30";

  const Err = ({ name }: { name: string }) =>
    errors[name] ? <p className="mt-1 text-xs text-danger">{errors[name][0]}</p> : null;

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      <section>
        <h2 className="font-display text-lg font-semibold text-ink-900">Basics</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-ink-800">
              Product name
            </label>
            <input id="name" value={form.name} onChange={set("name")} required className={inputCls} />
            <Err name="name" />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="slug" className="mb-1.5 block text-sm font-medium text-ink-800">
              Product address
            </label>
            <div className="flex items-center gap-1 rounded-xl border border-line bg-surface px-3">
              <span className="shrink-0 text-sm text-ink-400">/product/</span>
              <input
                id="slug"
                value={form.slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setForm((prev) => ({ ...prev, slug: slugify(e.target.value) }));
                }}
                required
                className="h-11 w-full bg-transparent text-sm outline-none"
              />
            </div>
            {productId && (
              <p className="mt-1 text-xs text-ink-400">
                Changing this keeps the old link working via a permanent redirect.
              </p>
            )}
            <Err name="slug" />
          </div>

          <div>
            <label htmlFor="categoryId" className="mb-1.5 block text-sm font-medium text-ink-800">
              Category
            </label>
            <select id="categoryId" value={form.categoryId} onChange={set("categoryId")} className={inputCls}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentName ? `${c.parentName} → ${c.name}` : c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="gender" className="mb-1.5 block text-sm font-medium text-ink-800">
              Gender
            </label>
            <select id="gender" value={form.gender} onChange={set("gender")} className={inputCls}>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g === "" ? "Not specified" : g[0].toUpperCase() + g.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="shortDescription" className="mb-1.5 block text-sm font-medium text-ink-800">
              Short description
            </label>
            <input
              id="shortDescription"
              value={form.shortDescription}
              onChange={set("shortDescription")}
              maxLength={300}
              placeholder="One line shoppers see under the title"
              className={inputCls}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-ink-800">
              Full description
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={set("description")}
              rows={5}
              maxLength={5000}
              className={areaCls}
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-ink-900">Price</h2>
        <p className="mb-5 mt-1 text-sm text-ink-500">
          Sakdha takes 2% of the product value. Shipping you charge is never commissioned.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="price" className="mb-1.5 block text-sm font-medium text-ink-800">
              Selling price (₹)
            </label>
            <input
              id="price" value={form.price} onChange={set("price")} required
              type="number" min="0" step="1" inputMode="numeric" className={inputCls}
            />
            {form.price && !Number.isNaN(Number(form.price)) && (
              <p className="mt-1 text-xs text-ink-400">
                You receive ₹{(Number(form.price) * 0.98).toFixed(2)} after commission.
              </p>
            )}
            <Err name="price" />
          </div>
          <div>
            <label htmlFor="compareAtPrice" className="mb-1.5 block text-sm font-medium text-ink-800">
              Compare-at price (₹) <span className="font-normal text-ink-400">optional</span>
            </label>
            <input
              id="compareAtPrice" value={form.compareAtPrice} onChange={set("compareAtPrice")}
              type="number" min="0" step="1" inputMode="numeric" className={inputCls}
            />
            <p className="mt-1 text-xs text-ink-400">Shown struck through. Must be higher.</p>
            <Err name="compareAtPrice" />
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-ink-900">Details</h2>
        <p className="mb-5 mt-1 text-sm text-ink-500">
          These power the filters shoppers use to narrow a category.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {([
            ["fabric", "Fabric", "cotton, silk, linen…"],
            ["pattern", "Pattern", "solid, striped…"],
            ["fit", "Fit", "regular, relaxed…"],
            ["occasion", "Occasion", "daily, festive…"],
            ["weightGrams", "Weight (grams)", "for shipping"],
          ] as const).map(([key, label, placeholder]) => (
            <div key={key}>
              <label htmlFor={key} className="mb-1.5 block text-sm font-medium text-ink-800">
                {label}
              </label>
              <input
                id={key}
                value={form[key]}
                onChange={set(key)}
                placeholder={placeholder}
                type={key === "weightGrams" ? "number" : "text"}
                min={key === "weightGrams" ? "0" : undefined}
                className={inputCls}
              />
            </div>
          ))}
          <div className="sm:col-span-3">
            <label htmlFor="washCare" className="mb-1.5 block text-sm font-medium text-ink-800">
              Wash care
            </label>
            <input id="washCare" value={form.washCare} onChange={set("washCare")} className={inputCls} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-ink-900">Search listing</h2>
        <p className="mb-5 mt-1 text-sm text-ink-500">
          Leave blank and we generate these from the product name and description.
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="seoTitle" className="mb-1.5 block text-sm font-medium text-ink-800">
              Title
            </label>
            <input id="seoTitle" value={form.seoTitle} onChange={set("seoTitle")} maxLength={160} className={inputCls} />
          </div>
          <div>
            <label htmlFor="seoDescription" className="mb-1.5 block text-sm font-medium text-ink-800">
              Description
            </label>
            <textarea
              id="seoDescription" value={form.seoDescription} onChange={set("seoDescription")}
              rows={2} maxLength={320} className={areaCls}
            />
          </div>
        </div>
      </section>

      <div className="border-t border-line pt-6">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : productId ? "Save changes" : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
