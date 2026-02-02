from setuptools import setup, find_packages

setup(
    name="foundry-mint",
    version="1.0.0",
    author="FoundryNet",
    description="Earn MINT tokens for your work. 0.005 MINT per second on Solana.",
    url="https://github.com/foundrynet/foundry_net_MINT",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        "solana>=0.30.0",
        "solders>=0.18.0",
    ],
)
