<script lang="ts">
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import Eye from 'lucide-svelte/icons/eye';
  import EyeOff from 'lucide-svelte/icons/eye-off';
  import LoaderCircle from 'lucide-svelte/icons/loader-circle';
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let showPassword = $state(false);
  let submitting = $state(false);
</script>

<svelte:head>
  <title>Kata sandi baru · Portal Keuangan</title>
  <!-- The URL carries a live reset token; keep it out of Referer headers. -->
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="min-h-screen flex items-center justify-center bg-background px-4">
  <div class="w-full max-w-[360px]">
    <div class="flex items-center gap-2.5 mb-6">
      <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
        <ChartColumn size={17} class="text-primary-foreground" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[15px] font-semibold text-foreground leading-tight">Portal Keuangan</p>
        <p class="text-[12px] text-muted-foreground">Grup Holding</p>
      </div>
    </div>

    {#if !data.token || form?.expired}
      <div class="bg-card border border-border rounded-lg p-5 space-y-3" role="alert">
        <p class="flex items-start gap-2 text-[14px] text-destructive">
          <TriangleAlert size={14} class="shrink-0 mt-0.5" />
          {form?.message ?? 'Tautan tidak valid. Minta tautan baru.'}
        </p>
        <a
          href="/login/lupa-password"
          class="w-full h-9 rounded-md bg-primary text-primary-foreground text-[14px] font-medium
                 flex items-center justify-center hover:bg-accent transition-colors"
        >
          Minta tautan baru
        </a>
      </div>
    {:else}
      <form
        method="POST"
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            await update();
            submitting = false;
          };
        }}
        class="bg-card border border-border rounded-lg p-5 space-y-4"
      >
        <input type="hidden" name="token" value={data.token} />

        <div class="space-y-1.5">
          <label for="password" class="block text-[13px] font-medium text-muted-foreground">Kata sandi baru</label>
          <div class="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autocomplete="new-password"
              minlength="8"
              required
              class="w-full h-9 pl-3 pr-9 rounded-md bg-background border border-border text-[14px] text-foreground
                     focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onclick={() => (showPassword = !showPassword)}
              aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              aria-pressed={showPassword}
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
          <p class="text-[12px] text-subtle">Minimal 8 karakter.</p>
        </div>

        <div class="space-y-1.5">
          <label for="confirm" class="block text-[13px] font-medium text-muted-foreground">Ulangi kata sandi</label>
          <input
            id="confirm"
            name="confirm"
            type={showPassword ? 'text' : 'password'}
            autocomplete="new-password"
            required
            class="w-full h-9 px-3 rounded-md bg-background border border-border text-[14px] text-foreground
                   focus:outline-none focus:border-primary"
          />
        </div>

        {#if form?.message}
          <p class="flex items-start gap-2 text-[13px] text-destructive" role="alert">
            <TriangleAlert size={13} class="shrink-0 mt-px" />
            {form.message}
          </p>
        {/if}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          class="w-full h-9 rounded-md bg-primary text-primary-foreground text-[14px] font-medium
                 flex items-center justify-center gap-2 hover:bg-accent transition-colors
                 disabled:opacity-80 disabled:cursor-wait disabled:hover:bg-primary"
        >
          {#if submitting}
            <LoaderCircle size={15} class="animate-spin" />
            Menyimpan…
          {:else}
            Simpan kata sandi
          {/if}
        </button>
      </form>
    {/if}

    <a href="/login" class="mt-4 inline-block text-[13px] text-muted-foreground hover:text-foreground">
      ← Kembali ke halaman masuk
    </a>
  </div>
</main>
