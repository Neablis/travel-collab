import { NativeSelect } from "web";

export function Default() {
  return (
    <NativeSelect defaultValue="EUR" style={{ width: 160 }}>
      <option value="USD">USD</option>
      <option value="EUR">EUR</option>
      <option value="GBP">GBP</option>
    </NativeSelect>
  );
}
