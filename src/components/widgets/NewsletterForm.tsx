"use client";

// Reproduces the live site's Mailchimp-for-WP form; submissions post to the
// WordPress install, which keeps handling the signup while it remains the CMS.
export function NewsletterForm({
  action,
  heading,
  instructions,
  namePlaceholder,
  emailPlaceholder,
  buttonLabel,
  variant,
}: {
  action: string;
  heading: string;
  instructions: string;
  namePlaceholder: string;
  emailPlaceholder: string;
  buttonLabel: string;
  variant: "band" | "sidebar";
}) {
  const band = variant === "band";
  return (
    <form method="post" action={action} className={band ? "mx-auto max-w-[860px] text-center" : ""}>
      <h3
        className={
          band
            ? "font-serif text-[28px] font-medium text-black"
            : "text-[18px] font-medium uppercase tracking-wide text-accent"
        }
      >
        {heading}
      </h3>
      <p className={`mt-4 mb-4 ${band ? "" : "text-[15px]"}`}>{instructions}</p>
      <div className={band ? "flex flex-col gap-3 sm:flex-row" : "flex flex-col gap-3"}>
        <input
          type="text"
          name="FNAME"
          placeholder={namePlaceholder}
          className="w-full flex-1 border border-peach-mid bg-white px-4 py-2.5 text-[15px] outline-none focus:border-accent"
        />
        <input
          type="email"
          name="EMAIL"
          required
          placeholder={emailPlaceholder}
          className="w-full flex-1 border border-peach-mid bg-white px-4 py-2.5 text-[15px] outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="w-full flex-1 cursor-pointer bg-accent px-5 py-2.5 text-[15px] text-white transition-colors hover:bg-navy sm:w-auto"
        >
          {buttonLabel}
        </button>
      </div>
      <label className="hidden!">
        Leave this field empty if you&apos;re human:{" "}
        <input type="text" name="_mc4wp_honeypot" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
      <input
        type="hidden"
        name="_mc4wp_timestamp"
        ref={(el) => {
          if (el && !el.value) el.value = String(Math.floor(Date.now() / 1000));
        }}
      />
      <input type="hidden" name="_mc4wp_form_id" value="6469" />
      <input type="hidden" name="_mc4wp_form_element_id" value="mc4wp-form-1" />
    </form>
  );
}
