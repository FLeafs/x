cd

echo "Installing dependencies"
yes | pkg update
yes | pkg upgrade
pkg install git -y
pkg install nodejs -y

echo "Cloning repository"
git clone https://github.com/FLeafs/x.git x

echo "NPM install"
cd && cd x
npm i node-fetch@2.6.1 express

echo "Done... sekarag run :"
echo ""
echo "cd && cd x && node index.js"
cd
