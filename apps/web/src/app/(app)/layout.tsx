import { AppHeader } from "@/components/AppHeader";

// The app chrome belongs to authenticated surfaces, not to every route. The
// front door — /welcome, /signin, /signup — draws its own header
// (FrontDoorHeader), so AppHeader moved out of the root layout and into this
// group's layout when M15 split the shell.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
