# Monitoraggio e avvisi

**Italiano** | [English](MONITORING.md)

Memora esegue un monitor leggero dentro il server. Controlla al massimo ogni
15 minuti e può inviare i nuovi avvisi al primo account Telegram attivo.

## Cosa controlla

- spazio disco di `MEMORA_DATA_DIR`;
- ultimo backup locale e fallimento del backup;
- fallimento dell’upload remoto;
- automazioni fallite o in timeout;
- avvisi attivi e prima occorrenza.

I backup mancanti vengono segnalati quando il backup automatico è attivo ma non
esiste ancora un archivio. I backup vecchi vengono segnalati dopo il numero di
giorni configurato.

## Impostazioni

In **Amministrazione → Sistema → Monitoraggio**:

- attiva/disattiva il monitor;
- attiva le notifiche Telegram;
- soglie disco warning e critica;
- età massima del backup.

Default:

```text
disco warning   80%
disco critico   90%
backup          8 giorni
```

## Comportamento degli avvisi

- Un nuovo avviso attivo viene inviato una volta.
- I controlli successivi non lo reinviano.
- Quando la condizione rientra viene inviato un messaggio di rientro.
- Se Telegram non è configurato, l’avviso resta visibile nella UI e può essere
  inviato dopo la configurazione di un account.
- Un errore di consegna Telegram non perde l’avviso: viene ritentato al controllo
  successivo.
- Lo stato degli avvisi è in `config/monitor-state.json` con permessi `0600`.
- Le impostazioni sono in `config/monitor.json`.

Il monitor non avvia modelli, backup o aggiornamenti. Osserva soltanto.

## Controllo manuale

**Controlla ora** nella sezione Monitoraggio esegue subito gli stessi controlli.

## Limiti noti

- Il monitor controlla solo ciò che Memora può osservare localmente.
- Non sostituisce un monitoraggio uptime esterno.
- Non può avvisare se l’host è completamente offline.
