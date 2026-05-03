import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import { createClientAction } from "../actions";

export default function NewClientPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/clients">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to clients
        </Link>
      </Button>

      <form action={createClientAction}>
        <Card>
          <CardHeader>
            <CardTitle>Add a new client</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Client name *</Label>
              <Input
                id="name"
                name="name"
                required
                placeholder="e.g. John & Jane Smith"
                autoFocus
                maxLength={200}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="primaryContactEmail">Email</Label>
                <Input
                  id="primaryContactEmail"
                  name="primaryContactEmail"
                  type="email"
                  placeholder="client@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="primaryContactPhone">Phone</Label>
                <Input
                  id="primaryContactPhone"
                  name="primaryContactPhone"
                  type="tel"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                maxLength={2000}
              />
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button asChild variant="outline">
              <Link href="/clients">Cancel</Link>
            </Button>
            <Button type="submit">Create client</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
