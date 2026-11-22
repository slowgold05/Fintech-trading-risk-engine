import { Button, State } from "../../kit";
import { errorMessage } from "./errors";

export function ReadFailure({ title, error, retry }: { title: string; error: unknown; retry: () => unknown }) {
  return <State kind="error" title={title} detail={errorMessage(error)} action={<Button onClick={() => void retry()}>Retry</Button>} />;
}
