<script lang="ts">
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import Eye from 'lucide-svelte/icons/eye';
  import EyeOff from 'lucide-svelte/icons/eye-off';
  import LoaderCircle from 'lucide-svelte/icons/loader-circle';
  import CircleCheck from 'lucide-svelte/icons/circle-check';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { parseTheme } from '$lib/theme';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
  let showPassword = $state(false);
  let submitting = $state(false);
</script>

<svelte:head><title>Masuk · IMR Platform</title></svelte:head>

<main class="min-h-screen flex items-center justify-center bg-background px-4">
  <div class="w-full max-w-[360px]">
    <div class="flex items-center gap-2.5 mb-6">
      <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
        <ChartColumn size={17} class="text-primary-foreground" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[14px] font-semibold text-foreground leading-tight">IMR Platform</p>
        <p class="text-[11px] text-muted-foreground">Keuangan &amp; Operasional</p>
      </div>
      <!-- The one screen every user meets before there is a sidebar to put
           this in; without it the preference is unreachable until you log in. -->
      <ThemeToggle theme={parseTheme(page.data.theme)} variant="icon" />
    </div>

    <form
      method="POST"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          // Covers the success redirect too: update() resolves after navigating.
          await update();
          submitting = false;
        };
      }}
      class="bg-card border border-border rounded-lg p-5 space-y-4">
      <div class="space-y-1.5">
        <label for="email" class="block text-[12px] font-medium text-muted-foreground">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autocomplete="username"
          required
          value={form?.email ?? ''}
          class="w-full h-9 px-3 rounded-md bg-background border border-border text-[13px] text-foreground
                 placeholder:text-subtle focus:outline-none focus:border-primary"
        />
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label for="password" class="block text-[12px] font-medium text-muted-foreground">Kata sandi</label>
          <a href="/login/lupa-password" class="text-[12px] text-primary hover:underline">Lupa kata sandi?</a>
        </div>
        <div class="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autocomplete="current-password"
            required
            class="w-full h-9 pl-3 pr-9 rounded-md bg-background border border-border text-[13px] text-foreground
                   focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onclick={() => (showPassword = !showPassword)}
            aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
            aria-pressed={showPassword}
            aria-controls="password"
            class="absolute inset-y-0 right-0 w-9 flex items-center justify-center rounded-r-md
                   text-muted-foreground hover:text-foreground focus:outline-none focus-visible:text-foreground"
          >
            {#if showPassword}
              <EyeOff size={15} />
            {:else}
              <Eye size={15} />
            {/if}
          </button>
        </div>
      </div>

      {#if page.url.searchParams.has('reset') && !form?.message}
        <p class="flex items-start gap-2 text-[12px] text-primary" role="status">
          <CircleCheck size={13} class="shrink-0 mt-px" />
          Kata sandi berhasil diganti. Silakan masuk dengan kata sandi baru.
        </p>
      {/if}

      {#if form?.message}
        <p class="flex items-start gap-2 text-[12px] text-destructive" role="alert">
          <TriangleAlert size={13} class="shrink-0 mt-px" />
          {form.message}
        </p>
      {/if}

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        class="w-full h-9 rounded-md bg-primary text-primary-foreground text-[13px] font-medium
               flex items-center justify-center gap-2 hover:bg-accent transition-colors
               disabled:opacity-80 disabled:cursor-wait disabled:hover:bg-primary"
      >
        {#if submitting}
          <LoaderCircle size={15} class="animate-spin" />
          Memproses…
        {:else}
          Masuk
        {/if}
      </button>
    </form>

    <p class="mt-4 text-[11px] text-subtle leading-relaxed">
      Akses diberikan oleh direksi. Hubungi administrator bila Anda belum memiliki akun.
    </p>
  </div>
</main>
