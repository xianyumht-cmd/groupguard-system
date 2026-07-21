git add .
if ($?) {
    git commit -m "feat: sync latest changes from onebot-plugin-groupguard"
}
if ($?) {
    git push origin main
}
