import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, MenuLabel, Button } from "web";

export function Default() {
  return (
    <div style={{ padding: 40, display: "flex", justifyContent: "flex-end" }}>
      <Menu open onOpenChange={() => {}}>
        <MenuTrigger>
          <Button variant="ghost" size="icon" aria-label="Actions for Alex R.">
            ⋯
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>Alex R.</MenuLabel>
          <MenuItem>Mark as travelling</MenuItem>
          <MenuItem>Change role…</MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive">Remove from trip…</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
