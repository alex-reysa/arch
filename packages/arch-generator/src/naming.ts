export function pascal(name: string): string {
  return name.replace(/(^\w|[_-]\w)/g, (m) => m.replace(/[_-]/, "").toUpperCase());
}

export function camel(name: string): string {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export function snake(name: string): string {
  return kebab(name).replace(/-/g, "_");
}
