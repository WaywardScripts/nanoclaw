cd ./container
./build.sh
cd ..
npm run build
sudo systemctl restart nanoclaw
