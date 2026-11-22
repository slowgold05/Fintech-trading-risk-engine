export function alertPrice(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return "$" + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction.replace(/0+$/, "").padEnd(2, "0");
}
