<script lang="ts">
  import type { PanelKind } from '$lib/store.svelte';

  import Clock from './clock/Clock.svelte';
  import Calendar from './calendar/Calendar.svelte';
  import WorldClock from './worldclock/WorldClock.svelte';
  import Timer from './timer/Timer.svelte';
  import Media from './media/Media.svelte';
  import SysMon from './sysmon/SysMon.svelte';
  import Battery from './power/Battery.svelte';
  import Power from './power/Power.svelte';
  import QuickSettings from './quick/QuickSettings.svelte';
  import Windows from './windows/Windows.svelte';
  import Workspaces from './workspaces/Workspaces.svelte';
  import Network from './network/Network.svelte';
  import Bluetooth from './bluetooth/Bluetooth.svelte';
  import Notifications from './notifications/Notifications.svelte';
  import Clipboard from './clipboard/Clipboard.svelte';
  import Trash from './trash/Trash.svelte';
  import Files from './files/Files.svelte';
  import Games from './games/Games.svelte';
  import Notes from './notes/Notes.svelte';
  import Chat from './chat/Chat.svelte';
  import Weather from './weather/Weather.svelte';
  import Perf from './perf/Perf.svelte';
  import Calc from './calc/Calc.svelte';
  import Tray from './tray/Tray.svelte';
  import Alarms from './alarms/Alarms.svelte';
  import Agenda from './agenda/Agenda.svelte';
  import Board from './board/Board.svelte';
  import Habits from './habits/Habits.svelte';
  import Links from './links/Links.svelte';
  import Apps from './apps/Apps.svelte';
  import Usage from './usage/Usage.svelte';
  import Browser from './browser/Browser.svelte';

  interface Props {
    kind: PanelKind;
    /** True while a window hides this display, so a module can stand down. */
    covered: boolean;
  }

  let { kind, covered }: Props = $props();
</script>

<!--
  Which component a panel holds.

  A plain branch rather than a lookup table: the modules do not share a props
  shape (the media panel is the only one that cares about occlusion), and this
  keeps every one of them type-checked at the point it is used. Each module is
  only mounted while its own setting is on, which is what makes an unused
  module cost nothing at all - its host subscriptions are acquired on mount.
-->
{#if kind === 'clock'}
  <Clock />
{:else if kind === 'calendar'}
  <Calendar />
{:else if kind === 'worldclock'}
  <WorldClock />
{:else if kind === 'timer'}
  <Timer />
{:else if kind === 'media'}
  <Media {covered} />
{:else if kind === 'sysmon'}
  <SysMon />
{:else if kind === 'battery'}
  <Battery />
{:else if kind === 'power'}
  <Power />
{:else if kind === 'quick'}
  <QuickSettings />
{:else if kind === 'windows'}
  <Windows />
{:else if kind === 'workspaces'}
  <Workspaces />
{:else if kind === 'network'}
  <Network />
{:else if kind === 'bluetooth'}
  <Bluetooth />
{:else if kind === 'notifications'}
  <Notifications />
{:else if kind === 'clipboard'}
  <Clipboard />
{:else if kind === 'trash'}
  <Trash />
{:else if kind === 'files'}
  <Files />
{:else if kind === 'games'}
  <Games />
{:else if kind === 'notes'}
  <Notes />
{:else if kind === 'chat'}
  <Chat />
{:else if kind === 'weather'}
  <Weather />
{:else if kind === 'perf'}
  <Perf />
{:else if kind === 'calc'}
  <Calc />
{:else if kind === 'tray'}
  <Tray />
{:else if kind === 'alarms'}
  <Alarms {covered} />
{:else if kind === 'agenda'}
  <Agenda />
{:else if kind === 'board'}
  <Board />
{:else if kind === 'habits'}
  <Habits />
{:else if kind === 'links'}
  <Links />
{:else if kind === 'apps'}
  <Apps />
{:else if kind === 'usage'}
  <Usage {covered} />
{:else if kind === 'browser'}
  <Browser />
{/if}
