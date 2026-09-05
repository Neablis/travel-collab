import { AppHeader } from "@/components/AppHeader";
import { PreferencesProvider } from "@/components/account/PreferencesProvider";

// The app chrome belongs to authenticated surfaces, not to every route. The
// front door — /welcome, /signin, /signup — draws its own header
// (FrontDoorHeader), so AppHeader moved out of the root layout and into this
// group's layout when M15 split the shell.
//
// M17: account preferences wrap BOTH halves, for the reason SaveLightProvider
// sits above the header in the root layout — the account settings Sheet lives
// in the header's avatar menu and the distances it changes are rendered in the
// page below it, so one provider over both is what lets a switch to Miles
// re-render the map rail without a reload. It reads through the API, not from
// `@/server/*`: this file is UI and the lint wall applies to it (see the
// provider's own note). A client provider here does not make this layout a
// client component — `children` arrives as an already-rendered server tree.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PreferencesProvider>
      <AppHeader />
      {children}
    </PreferencesProvider>
  );
}
