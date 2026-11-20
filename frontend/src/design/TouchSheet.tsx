import { lazy, Suspense, type ComponentProps } from "react";

const Dialog = lazy(() => import("./TouchSheetDialog"));

export function TouchSheet(props: ComponentProps<typeof Dialog>) {
  return (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  );
}
