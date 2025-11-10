"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService } from "@/lib/services";

export function LoginForm() {
  const router = useRouter();

  const loginMutation = useMutation({
    mutationFn: () => apiService.login("demo@example.com", "demo"),
    onSuccess: () => {
      router.push("/");
      router.refresh();
    },
  });

  const handleLogin = () => {
    loginMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Clinical Notes Analysis</CardTitle>
        <CardDescription>Click the button below to access the RAG-enhanced clinical analysis application</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          <Button
            onClick={handleLogin}
            className="w-full"
            size="lg"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "Loading Application..." : "Enter Application"}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            No credentials required - one-click access for demo purposes
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
