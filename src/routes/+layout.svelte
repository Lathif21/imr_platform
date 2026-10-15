<script lang="ts">
  import '../app.css';
  import IndikatorSibuk from '$lib/components/IndikatorSibuk.svelte';

  let { children } = $props();
</script>

<IndikatorSibuk />

{@render children()}
