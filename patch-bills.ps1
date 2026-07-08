$lines = [System.Collections.ArrayList]@(Get-Content "G:\Projects\React\MamePilot\pages\Bills.tsx")

# Change 1: Insert payment status variables after line 621 (hasRowActions) and the blank line 622
$insertLines1 = @(
    ""
    "                const paymentStatusLabel = getPaymentStatusLabel(bill.paidAmount, bill.total, bill.history);"
    "                const isPartiallyPaid = paymentStatusLabel === 'Partially paid' || paymentStatusLabel === 'Partially Paid';"
    "                const isUnpaid = paymentStatusLabel === 'Unpaid';"
    "                const isRefunded = paymentStatusLabel === 'Refunded';"
    '                const isFullyPaid = !isPartiallyPaid && !isUnpaid && !isRefunded && bill.paidAmount >= bill.total;'
    "                const paidAmountTextColor = isPartiallyPaid ? 'text-amber-500' : isRefunded ? 'text-orange-500' : isUnpaid ? 'text-red-500' : 'text-green-500';"
)

$offset = 0
foreach ($line in $insertLines1) {
    $lines.Insert(622 + $offset, $line)
    $offset++
}

# Find the formatCurrency(bill.total) line (shifted by 7 lines now)
$newTotalLine = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'formatCurrency\(bill\.total\)') {
        $newTotalLine = $i
        break
    }
}
Write-Host "formatCurrency line now at: $($newTotalLine + 1)"

# Change 2: Insert payment status display after the total span line, before the closing </td>
$insertLines2 = @(
    '                    {isRefunded ? ('
    '                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>'
    '                        Refunded'
    '                      </p>'
    '                    ) : isUnpaid ? ('
    '                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>'
    '                        Unpaid'
    '                      </p>'
    '                    ) : isFullyPaid ? ('
    '                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>'
    '                        Paid'
    '                      </p>'
    '                    ) : bill.paidAmount > 0 ? ('
    '                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>'
    '                        {`Paid: ${formatCurrency(bill.paidAmount)}`}'
    '                      </p>'
    '                    ) : null}'
)

# Insert after the formatCurrency line (index newTotalLine), before </td> (index newTotalLine+1)
$offset2 = 0
foreach ($line in $insertLines2) {
    $lines.Insert($newTotalLine + 1 + $offset2, $line)
    $offset2++
}

$lines | Set-Content "G:\Projects\React\MamePilot\pages\Bills.tsx" -NoNewline

Write-Host "Done."