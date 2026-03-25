import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
      <h2 className="text-lg font-semibold">Page not found</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        That route does not exist. Use the navigation menu or go home.
      </p>
      <Link href="/">
        <Button variant="default">Back to home</Button>
      </Link>
    </div>
  );
}
