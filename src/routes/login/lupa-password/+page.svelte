<script lang="ts">
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import MailCheck from 'lucide-svelte/icons/mail-check';
  import LoaderCircle from 'lucide-svelte/icons/loader-circle';
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
  let submitting = $state(false);
</script>

<svelte:head><title>Lupa kata sandi · Portal Keuangan</title></svelte:head>

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

    {#if form?.sent}
      <div class="bg-card border border-border rounded-lg p-5 space-y-3" role="status">
        <MailCheck size={20} class="text-primary" />
        <p class="text-[14px] font-medium text-foreground">Periksa email Anda</p>
        <p class="text-[13px] text-muted-foreground leading-relaxed">
          Bila <span class="text-foreground">{form.email}</span> terdaftar, tautan untuk mengatur ulang kata sandi
          sudah dikirim. Tautan berlaku 15 menit. Periksa juga folder spam.
        </p>
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
        <p class="text-[13px] text-muted-foreground leading-relaxed">
          Masukkan email akun Anda. Kami akan mengirim tautan untuk membuat kata sandi baru.
        </p>

        <div class="space-y-1.5">
          <label for="email" class="block text-[13px] font-medium text-muted-foreground">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autocomplete="username"
            required
            value={form?.email ?? ''}
            class="w-full h-9 px-3 rounded-md bg-background border border-border text-[14px] text-foreground
                   placeholder:text-subtle focus:outline-none focus:border-primary"
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
            Mengirim…
          {:else}
            Kirim tautan
          {/if}
        </button>
      </form>
    {/if}

    <a href="/login" class="mt-4 inline-block text-[13px] text-muted-foreground hover:text-foreground">
      ← Kembali ke halaman masuk
    </a>
  </div>
</main>
