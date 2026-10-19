import { getCountries, getCountryCallingCode } from "libphonenumber-js";

export type CountryOption = { code: string; label: string };

let cache: CountryOption[] | null = null;

/** All countries libphonenumber knows, as "India (+91)", sorted by name. */
export function countryOptions(): CountryOption[] {
  if (cache) return cache;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  cache = getCountries()
    .map((c) => {
      const name = names?.of(c) ?? c;
      return { code: c, name, label: `${name} (+${getCountryCallingCode(c)})` };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ code, label }) => ({ code, label }));
  return cache;
}
